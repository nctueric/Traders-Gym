// Device-local appearance only; never reads or changes account/ledger storage.
try {
  document.documentElement.dataset.theme = localStorage.getItem("traders-gym:appearance") === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
