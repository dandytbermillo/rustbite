export type WorkspaceMenuToolbarMode = "auto" | "open" | "hidden";

export const WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY =
  "rushbite:admin-workspace-menu-toolbar:v1";

const WORKSPACE_MENU_TOOLBAR_PREFERENCE_VERSION = 1;

type WorkspaceMenuToolbarPreference = {
  version: typeof WORKSPACE_MENU_TOOLBAR_PREFERENCE_VERSION;
  mode: Exclude<WorkspaceMenuToolbarMode, "auto">;
};

type WorkspaceMenuToolbarStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function isStoredToolbarMode(
  value: unknown,
): value is WorkspaceMenuToolbarPreference["mode"] {
  return value === "open" || value === "hidden";
}

export function parseWorkspaceMenuToolbarPreference(
  raw: string | null,
): WorkspaceMenuToolbarMode | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceMenuToolbarPreference>;
    if (
      parsed?.version !== WORKSPACE_MENU_TOOLBAR_PREFERENCE_VERSION ||
      !isStoredToolbarMode(parsed.mode)
    ) {
      return null;
    }
    return parsed.mode;
  } catch {
    return null;
  }
}

export function workspaceMenuToolbarStorage(): WorkspaceMenuToolbarStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWorkspaceMenuToolbarPreference(
  storage: Pick<Storage, "getItem"> | null,
): WorkspaceMenuToolbarMode | null {
  if (!storage) return null;
  try {
    return parseWorkspaceMenuToolbarPreference(
      storage.getItem(WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function writeWorkspaceMenuToolbarPreference(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  mode: WorkspaceMenuToolbarMode,
) {
  if (!storage) return;

  try {
    if (mode === "auto") {
      storage.removeItem(WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY);
      return;
    }

    const payload: WorkspaceMenuToolbarPreference = {
      version: WORKSPACE_MENU_TOOLBAR_PREFERENCE_VERSION,
      mode,
    };
    storage.setItem(
      WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Toolbar persistence is a convenience. The widget remains usable.
  }
}
