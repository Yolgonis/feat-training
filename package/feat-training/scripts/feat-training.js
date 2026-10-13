(() => {
  const path = "modules/feat-training/scripts/feat-training-tracker.js";
  const script = document.createElement("script");
  script.src = globalThis.foundry?.utils?.getRoute
    ? globalThis.foundry.utils.getRoute(path)
    : `/${path}`;
  script.defer = true;
  document.head.appendChild(script);
})();
