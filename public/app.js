const DATA_URL = "./data/news.json";

const $ = (id) => document.getElementById(id);

const arabicDate = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Vienna",
});

const arabicStamp = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Vienna",
});

const relative = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

function fromNow(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.round((then - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  if (abs < 60) return relative.format(diffMin, "minute");
  const hours = Math.round(diffMin / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cardMarkup(item, heading) {
  const tag = heading;
  return `
    <article class="${heading === "h2" ? "lead-card" : "card"}">
      <div class="kicker">
        <span>${escapeHtml(item.categoryAr || item.category)}</span>
        <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(fromNow(item.publishedAt))}</time>
      </div>
      <${tag}>${escapeHtml(item.titleAr)}</${tag}>
      <p class="original" lang="de" dir="ltr">${escapeHtml(item.title)}</p>
      <a class="cta" href="${escapeHtml(item.link)}" rel="noopener noreferrer">اقرأ الأصل في ORF</a>
    </article>
  `;
}

function uniqueCategories(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.category)) {
      map.set(item.category, item.categoryAr || item.category);
    }
  }
  return [...map.entries()];
}

function renderFilters(categories, active) {
  const row = $("filters");
  const all = [
    ["all", "الكل"],
    ...categories,
  ];
  row.innerHTML = all
    .map(
      ([id, label]) => `
      <button class="chip" type="button" data-cat="${escapeHtml(id)}" aria-pressed="${
        id === active
      }">${escapeHtml(label)}</button>`,
    )
    .join("");
}

function render(items, active) {
  const filtered =
    active === "all" ? items : items.filter((item) => item.category === active);
  const [lead, ...rest] = filtered;
  const leadEl = $("lead");
  const grid = $("grid");
  if (!lead) {
    leadEl.hidden = true;
    leadEl.innerHTML = "";
    grid.innerHTML = `<p class="status">لا توجد أخبار في هذا التصنيف حالياً.</p>`;
    return;
  }
  leadEl.hidden = false;
  leadEl.innerHTML = cardMarkup(lead, "h2");
  grid.innerHTML = rest.map((item) => cardMarkup(item, "h3")).join("");
}

async function boot() {
  $("masthead-date").textContent = arabicDate.format(new Date());
  let data;
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch (err) {
    $("status").hidden = false;
    $("status").textContent =
      "تعذّر تحميل النشرة. حاول تحديث الصفحة بعد قليل.";
    console.error(err);
    return;
  }

  $("updated-at").dateTime = data.updatedAt;
  $("updated-at").textContent = data.updatedAt
    ? arabicStamp.format(new Date(data.updatedAt))
    : "—";

  const items = Array.isArray(data.items) ? data.items : [];
  const categories = uniqueCategories(items);
  let active = "all";
  renderFilters(categories, active);
  render(items, active);

  $("filters").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-cat]");
    if (!btn) return;
    active = btn.dataset.cat;
    renderFilters(categories, active);
    render(items, active);
  });
}

boot();
