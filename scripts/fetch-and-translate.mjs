#!/usr/bin/env node
/**
 * Holt den ORF-RSS-Feed, übersetzt neue Titel journalistisch ins Arabische
 * und schreibt public/data/news.json plus einen Übersetzungscache.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FEED_URL = process.env.ORF_FEED_URL || "https://rss.orf.at/news.xml";
const NEWS_PATH = join(ROOT, "public/data/news.json");
const CACHE_PATH = join(ROOT, "data/translation-cache.json");
const MAX_ITEMS = 32;

const CATEGORY_AR = {
  Inland: "النمسا",
  Ausland: "العالم",
  Wirtschaft: "اقتصاد",
  Kultur: "ثقافة",
  Chronik: "أحداث",
  Sport: "رياضة",
  Wissenschaft: "علوم",
  Wetter: "طقس",
  Panorama: "منوعات",
  Religion: "دين",
  "Netzwelt": "رقمي",
  Digital: "رقمي",
  Österreich: "النمسا",
  News: "أخبار",
};

const SYSTEM_PROMPT = `أنت محرر أخبار عربي مخضرم في صحيفة يومية رصينة (أسلوب الشرق الأوسط / السفير / الحياة).
تُترجم عناوين الأخبار النمساوية المكتوبة بالألمانية إلى العربية الفصحى المعاصرة المستخدمة في عناوين الصحف.

قواعد صارمة:
- لا تترجم حرفياً كلمة بكلمة. أعد صياغة العنوان كما يصوغه صحفي عربي ناطق بالعربية.
- اجعل العنوان قصيراً، إيقاعياً، وواضحاً — عنوان صحيفة لا جملة شارحة.
- الأسماء العلم بصيغتها الشائعة عربياً (فيينا، ترامب، كييف، موسكو، لاغارد، الاتحاد الأوروبي…).
- لا تُضف معلومات غير واردة في الأصل.
- لا تشرح الخبر. لا تضف رأياً.
- أعد JSON فقط دون Markdown.`;

function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function inner(block, tag, ns) {
  const name = ns ? `${ns}:${tag}` : tag;
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  return match ? decodeEntities(match[1]) : "";
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const block = match[0];
    const about = block.match(/rdf:about="([^"]+)"/);
    const link = inner(block, "link") || about?.[1] || "";
    const title = inner(block, "title");
    if (!title || !link) continue;
    items.push({
      id: about?.[1] || link,
      title,
      link,
      category: inner(block, "subject", "dc") || "News",
      publishedAt: inner(block, "date", "dc") || new Date().toISOString(),
      description: inner(block, "description") || "",
    });
  }
  return items;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function translateBatch(items, { apiKey, model, baseUrl }) {
  const payload = items.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
  }));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `ترجم هذه العناوين. أعد كائناً بالشكل {"titles":[{"id":"...","titleAr":"..."}]}.\n${JSON.stringify(payload)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Leere LLM-Antwort");
  const parsed = JSON.parse(content);
  const list = parsed.titles || parsed.items || parsed.translations || [];
  const map = new Map();
  for (const row of list) {
    if (row?.id && row?.titleAr) map.set(row.id, String(row.titleAr).trim());
  }
  return map;
}

async function translateAll(pending, env) {
  const map = new Map();
  const chunkSize = 10;
  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    const part = await translateBatch(chunk, env);
    for (const [id, titleAr] of part) map.set(id, titleAr);
  }
  return map;
}

function categoryAr(de) {
  return CATEGORY_AR[de] || de;
}

async function loadDotEnv() {
  try {
    const text = await readFile(join(ROOT, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* keine lokale .env – in CI kommen Werte aus Secrets */
  }
}

async function main() {
  await loadDotEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

  console.log(`Feed: ${FEED_URL}`);
  const res = await fetch(FEED_URL, {
    headers: {
      "User-Agent": "orf-arabisch/1.0 (persönliches Nachrichtenarchiv)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`RSS ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const items = parseRss(xml).slice(0, MAX_ITEMS);
  if (!items.length) throw new Error("Keine Einträge im RSS-Feed");
  console.log(`${items.length} Meldungen gelesen`);

  const cache = await readJson(CACHE_PATH, {});
  const pending = items.filter((item) => {
    const hit = cache[item.id];
    return !hit || hit.sourceTitle !== item.title || !hit.titleAr;
  });

  let translations = new Map();
  if (pending.length === 0) {
    console.log("Alle Titel bereits übersetzt (Cache).");
  } else if (!apiKey) {
    const msg =
      "OPENAI_API_KEY fehlt – neue Titel bleiben vorerst unübersetzt.";
    if (ci) throw new Error(msg);
    console.warn(msg);
  } else {
    console.log(`${pending.length} Titel übersetzen…`);
    translations = await translateAll(pending, { apiKey, model, baseUrl });
  }

  const news = items.map((item) => {
    const cached = cache[item.id];
    const titleAr =
      translations.get(item.id) ||
      (cached?.sourceTitle === item.title ? cached.titleAr : "") ||
      "";
    if (titleAr) {
      cache[item.id] = { sourceTitle: item.title, titleAr };
    }
    return {
      id: item.id,
      title: item.title,
      titleAr: titleAr || item.title,
      translated: Boolean(titleAr),
      link: item.link,
      category: item.category,
      categoryAr: categoryAr(item.category),
      publishedAt: item.publishedAt,
      description: item.description,
    };
  });

  const payload = {
    source: {
      name: "ORF news.ORF.at",
      feed: FEED_URL,
      homepage: "https://orf.at/",
    },
    updatedAt: new Date().toISOString(),
    items: news,
  };

  await mkdir(dirname(NEWS_PATH), { recursive: true });
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(NEWS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  console.log(`Geschrieben: ${NEWS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
