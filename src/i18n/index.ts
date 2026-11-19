import he from "./he.json";

type Messages = typeof he;

// Dot-separated paths to string leaves, e.g. "branches.title".
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly string[]
      ? never
      : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, he);
}

/** Returns the Hebrew UI string for `key`, replacing {placeholders} with `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const value = lookup(key);
  if (typeof value !== "string") return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** For keys built at runtime (enum values from the database). Falls back to the key. */
export function tDynamic(key: string, vars?: Record<string, string | number>): string {
  return t(key as MessageKey, vars);
}

