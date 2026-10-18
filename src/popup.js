function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function buildSiteItem(domain, ms, index) {
  const minutes = Math.round(ms / 60000);
  const display = minutes < 1 ? "< 1 min" : `${minutes} min`;

  const li = document.createElement("li");

  const favicon = document.createElement("div");
  favicon.className = "site-favicon";

  const img = document.createElement("img");
  img.src = faviconUrl(domain);
  img.alt = "";
  img.addEventListener("error", function () {
    favicon.classList.add("no-icon");
  });

  const fallback = document.createElement("span");
  fallback.className = "fallback";
  fallback.textContent = domain.charAt(0);

  favicon.append(img, fallback);

  const info = document.createElement("div");
  info.className = "site-info";

  const name = document.createElement("div");
  name.className = "site-name";
  name.textContent = domain;

  const count = document.createElement("div");
  count.className = "site-count";
  count.textContent = display;

  info.append(name, count);

  const rank = document.createElement("span");
  rank.className = "site-rank";
  rank.textContent = "#" + (index + 1);

  li.append(favicon, info, rank);
  return li;
}

function showMessage(list, text) {
  list.replaceChildren();
  const li = document.createElement("li");
  li.className = "loading";
  li.textContent = text;
  list.appendChild(li);
}

async function loadToday() {
  const todayKey = formatDate(new Date());
  const result = await chrome.storage.local.get(todayKey);
  const list = document.getElementById("today-list");
  const data = result[todayKey];

  if (!data || !data.sites || Object.keys(data.sites).length === 0) {
    showMessage(list, "No data yet, go browse a bit!");
    return;
  }

  const top5 = Object.entries(data.sites)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  list.replaceChildren(
    ...top5.map(([domain, ms], index) => buildSiteItem(domain, ms, index))
  );
}

let weeklyChart = null;

async function loadWeekly() {
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(formatDate(d));
  }

  const result = await chrome.storage.local.get(last7Days);

  const domainTotals = {};
  last7Days.forEach(function (dateKey) {
    const sites = (result[dateKey] && result[dateKey].sites) || {};
    Object.entries(sites).forEach(function ([domain, ms]) {
      domainTotals[domain] = (domainTotals[domain] || 0) + ms;
    });
  });

  const top5Domains = Object.entries(domainTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain]) => domain);

  const colors = ["#6320ee", "#a78bfa", "#f59e0b", "#10b981", "#ef4444"];

  const datasets = top5Domains.map(function (domain, i) {
    const data = last7Days.map(function (dateKey) {
      const sites = (result[dateKey] && result[dateKey].sites) || {};
      return Math.round((sites[domain] || 0) / 60000);
    });

    return {
      label: domain,
      data: data,
      backgroundColor: colors[i],
      borderRadius: i === top5Domains.length - 1 ? 6 : 0,
    };
  });

  const labels = last7Days.map(function (dateKey) {
    return new Date(dateKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
  });

  if (weeklyChart) weeklyChart.destroy();

  const ctx = document.getElementById("weekly-chart").getContext("2d");
  weeklyChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#666",
            font: { size: 10, family: "DM Sans" },
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 3,
            padding: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              return ` ${context.dataset.label}: ${context.parsed.y} min`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#888", font: { size: 11 } },
          grid: { display: false },
        },
        y: {
          stacked: true,
          ticks: { color: "#888", font: { size: 11 } },
          grid: { color: "#f0f0f0" },
        },
      },
    },
  });
}

let chartRendered = false;

document.getElementById("tab-today").addEventListener("click", function () {
  document.getElementById("view-today").classList.remove("hidden");
  document.getElementById("view-weekly").classList.add("hidden");
  document.getElementById("tab-today").classList.add("active");
  document.getElementById("tab-weekly").classList.remove("active");
});

document.getElementById("tab-weekly").addEventListener("click", function () {
  document.getElementById("view-weekly").classList.remove("hidden");
  document.getElementById("view-today").classList.add("hidden");
  document.getElementById("tab-weekly").classList.add("active");
  document.getElementById("tab-today").classList.remove("active");

  if (!chartRendered) {
    loadWeekly();
    chartRendered = true;
  }
});

loadToday();