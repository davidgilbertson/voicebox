const DISABLE_FOCUS_CLASS = "disable-focus-rings";

export function installFocusVisibilityPolicy() {
  const root = document.documentElement;
  root.classList.add(DISABLE_FOCUS_CLASS);

  const enableFocusRings = (event) => {
    if (event.key !== "Tab" && event.key !== " " && event.key !== "Spacebar") {
      return;
    }

    root.classList.remove(DISABLE_FOCUS_CLASS);
    document.removeEventListener("keydown", enableFocusRings, true);
  };

  document.addEventListener("keydown", enableFocusRings, true);
}

export { DISABLE_FOCUS_CLASS };
