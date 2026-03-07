const DISABLE_FOCUS_CLASS = "disable-focus-rings";

export function installFocusVisibilityPolicy(doc = document) {
  const root = doc.documentElement;
  root.classList.add(DISABLE_FOCUS_CLASS);

  const enableFocusRings = (event) => {
    if (event.key !== "Tab" && event.key !== " " && event.key !== "Spacebar") {
      return;
    }

    root.classList.remove(DISABLE_FOCUS_CLASS);
    doc.removeEventListener("keydown", enableFocusRings, true);
  };

  doc.addEventListener("keydown", enableFocusRings, true);
}

export { DISABLE_FOCUS_CLASS };
