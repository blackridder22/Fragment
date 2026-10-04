(() => {
  "use strict";

  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".nav-links");
  const setMenu = (open) => {
    navigation.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    menuButton
      .querySelector("use")
      .setAttribute("href", `assets/icons.svg#${open ? "x" : "menu-2"}`);
  };
  menuButton.addEventListener("click", () =>
    setMenu(menuButton.getAttribute("aria-expanded") !== "true"),
  );
  navigation
    .querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav")) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      menuButton.getAttribute("aria-expanded") === "true"
    ) {
      setMenu(false);
      menuButton.focus();
    }
  });

  const tour = {
    vault: {
      file: "fragment-vault.webp",
      alt: "Fragment's Vault view showing visual collections and recently added references",
      caption: "A place for every project, mood, and passing obsession.",
    },
    browse: {
      file: "fragment-browse.webp",
      alt: "Fragment's visual gallery with image, source, tag, and color filters",
      caption:
        "See the bigger picture. Browse your references together and find the right one.",
    },
    detail: {
      file: "fragment-detail.webp",
      alt: "Fragment's focused image preview with title, source, tags, and notes",
      caption: "Remember what caught your eye, and where it came from.",
    },
  };
  const tabs = [...document.querySelectorAll("[data-tour]")];
  const productImage = document.querySelector("#product-image");
  const productPanel = document.querySelector("#tour-panel");
  const selectTour = (tab) => {
    const selected = tour[tab.dataset.tour];
    tabs.forEach((item) => {
      item.setAttribute("aria-selected", String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    });
    productPanel.setAttribute("aria-labelledby", tab.id);
    productImage.src = `assets/images/${selected.file}`;
    productImage.alt = selected.alt;
    document.querySelector("#tour-caption").textContent = selected.caption;
    productImage.parentElement.classList.remove("is-changing");
    requestAnimationFrame(() =>
      productImage.parentElement.classList.add("is-changing"),
    );
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTour(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTour(tabs[next]);
      tabs[next].focus();
    });
  });

  const filters = [...document.querySelectorAll("[data-filter]")];
  const references = [...document.querySelectorAll(".reference")];
  filters.forEach((filter) =>
    filter.addEventListener("click", () => {
      const category = filter.dataset.filter;
      filters.forEach((item) =>
        item.setAttribute("aria-pressed", String(item === filter)),
      );
      references.forEach((item) => {
        item.hidden = category !== "all" && item.dataset.category !== category;
      });
      document
        .querySelector("#reference-grid")
        .classList.toggle("is-filtered", category !== "all");
      const count = references.filter((item) => !item.hidden).length;
      document.querySelector("#filter-status").textContent =
        `${count} sample references shown`;
    }),
  );

  let dialogOpener = null;
  const showDialog = (dialog, opener) => {
    const previous = document.querySelector("dialog[open]");
    if (previous) previous.close();
    // Preserve a visible opener when moving from one dialog to another.
    if (!opener.closest("dialog")) dialogOpener = opener;
    dialog.showModal();
  };
  document.querySelectorAll("[data-open]").forEach((opener) =>
    opener.addEventListener("click", (event) => {
      const dialog = document.getElementById(opener.dataset.open);
      if (!dialog || typeof dialog.showModal !== "function") return;
      event.preventDefault();
      showDialog(dialog, opener);
    }),
  );
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog
      .querySelectorAll("[data-close]")
      .forEach((button) =>
        button.addEventListener("click", () => dialog.close()),
      );
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (!document.querySelector("dialog[open]") && dialogOpener?.isConnected)
        dialogOpener.focus();
    });
  });
  references.forEach((reference) =>
    reference.addEventListener("click", () => {
      const preview = document.querySelector("#reference-image");
      preview.src = `assets/images/${reference.dataset.file}`;
      preview.alt = reference.querySelector("img").alt;
      document.querySelector("#reference-title").textContent =
        reference.dataset.title;
      document.querySelector("#reference-note").textContent =
        reference.dataset.note;
      showDialog(document.querySelector("#reference-dialog"), reference);
    }),
  );

  const themeButton = document.querySelector(".theme-toggle");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () =>
    document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : systemTheme.matches;
  const updateThemeButton = () => {
    themeButton.setAttribute(
      "aria-label",
      isDark() ? "Switch to light theme" : "Switch to dark theme",
    );
    themeButton
      .querySelector("use")
      .setAttribute("href", `assets/icons.svg#${isDark() ? "sun" : "moon"}`);
    document.querySelector('meta[name="theme-color"]').content = isDark()
      ? "#141a16"
      : "#f6f7f4";
  };
  themeButton.addEventListener("click", () => {
    document.documentElement.dataset.theme = isDark() ? "light" : "dark";
    updateThemeButton();
  });
  systemTheme.addEventListener("change", updateThemeButton);
  updateThemeButton();

  if (
    "IntersectionObserver" in window &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );
    document
      .querySelectorAll(".reveal")
      .forEach((element) => observer.observe(element));
  }
})();
