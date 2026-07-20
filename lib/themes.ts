export type DomainTheme = {
  styleId: string;
  styleName: string;
  className: string;
  mode: "dark" | "light";
};

export const THEMES: DomainTheme[] = [
  { styleId: "modern-dark", styleName: "Modern Dark", className: "theme-hypervault", mode: "dark" },
  { styleId: "academia", styleName: "Academia", className: "theme-academia", mode: "dark" },
  { styleId: "art-deco", styleName: "Art Deco", className: "theme-deco", mode: "dark" },
  { styleId: "aurora-mesh", styleName: "Aurora Mesh", className: "theme-aurora", mode: "dark" },
  { styleId: "bauhaus", styleName: "Bauhaus", className: "theme-bauhaus", mode: "light" },
  { styleId: "bold-typography", styleName: "Bold Typography", className: "theme-boldtype", mode: "dark" },
  { styleId: "botanical", styleName: "Botanical", className: "theme-botanical", mode: "light" },
  { styleId: "claymorphism", styleName: "Clay", className: "theme-clay", mode: "light" },
  { styleId: "cyberpunk", styleName: "Cyberpunk", className: "theme-cyber", mode: "dark" },
  { styleId: "enterprise", styleName: "Corporate Trust", className: "theme-enterprise", mode: "light" },
  { styleId: "flat-design", styleName: "Flat Design", className: "theme-flat", mode: "light" },
  { styleId: "glassmorphism", styleName: "Glassmorphism", className: "theme-glass", mode: "dark" },
  { styleId: "hyperstudio", styleName: "Hyperstudio", className: "theme-hyperstudio", mode: "dark" },
  { styleId: "industrial", styleName: "Industrial", className: "theme-industrial", mode: "light" },
  { styleId: "kinetic", styleName: "Kinetic", className: "theme-kinetic", mode: "dark" },
  { styleId: "luxury", styleName: "Luxury", className: "theme-luxury", mode: "light" },
  { styleId: "material-design", styleName: "Material", className: "theme-material", mode: "light" },
  { styleId: "maximalism", styleName: "Maximalism", className: "theme-max", mode: "light" },
  { styleId: "minimal-dark", styleName: "Minimal Dark", className: "theme-minimal-dark", mode: "dark" },
  { styleId: "monochrome", styleName: "Monochrome", className: "theme-ink", mode: "light" },
  { styleId: "neo-brutalism", styleName: "Neo-brutalism", className: "theme-brutalist", mode: "light" },
  { styleId: "neumorphism", styleName: "Neumorphism", className: "theme-neu", mode: "light" },
  { styleId: "newsprint", styleName: "Newsprint", className: "theme-newsprint", mode: "light" },
  { styleId: "organic", styleName: "Organic", className: "theme-organic", mode: "light" },
  { styleId: "playful-geometric", styleName: "Playful Geometric", className: "theme-playful", mode: "light" },
  { styleId: "professional", styleName: "Professional", className: "theme-professional", mode: "light" },
  { styleId: "retro", styleName: "Retro", className: "theme-retro", mode: "light" },
  { styleId: "saas", styleName: "SaaS", className: "theme-saas", mode: "light" },
  { styleId: "sketch", styleName: "Sketch", className: "theme-sketch", mode: "light" },
  { styleId: "swiss-minimalist", styleName: "Swiss Minimalist", className: "theme-swiss", mode: "light" },
  { styleId: "terminal", styleName: "Terminal CLI", className: "theme-terminal", mode: "dark" },
  { styleId: "vaporwave", styleName: "Vaporwave", className: "theme-vapor", mode: "dark" },
  { styleId: "web3", styleName: "Web3", className: "theme-web3", mode: "dark" },
  { styleId: "gsap", styleName: "Gsap", className: "theme-gsap", mode: "dark" },
];

const THEMES_BY_ID = new Map(THEMES.map((t) => [t.styleId, t]));

export function themeById(styleId: string | null | undefined): DomainTheme | undefined {
  return styleId ? THEMES_BY_ID.get(styleId) : undefined;
}

export function isThemeId(styleId: unknown): styleId is string {
  return typeof styleId === "string" && THEMES_BY_ID.has(styleId);
}

export const DEFAULT_THEME: DomainTheme = THEMES_BY_ID.get("gsap")!;

export const DOMAIN_THEMES: Record<string, DomainTheme> = {
  "vault.cool": THEMES_BY_ID.get("aurora-mesh")!,
  "agentvault.cloud": THEMES_BY_ID.get("glassmorphism")!,
  "cleon.wiki": THEMES_BY_ID.get("newsprint")!,
  "inkbound.ink": THEMES_BY_ID.get("monochrome")!,
  "claudedamnit.com": THEMES_BY_ID.get("hyperstudio")!,
  "cleon.casa": THEMES_BY_ID.get("claymorphism")!,
  "cleon.city": THEMES_BY_ID.get("cyberpunk")!,
  "tinderforai.com": THEMES_BY_ID.get("vaporwave")!,
  "onlywizards.website": THEMES_BY_ID.get("academia")!,
  "hypervault.store": DEFAULT_THEME,
  "ralphy.website": THEMES_BY_ID.get("retro")!,
  "permaclaw.com": THEMES_BY_ID.get("terminal")!,
  "bo.dy": THEMES_BY_ID.get("neumorphism")!,
};

export function themeForDomain(domain: string | null | undefined): DomainTheme {
  return DOMAIN_THEMES[(domain ?? "").toLowerCase()] ?? DEFAULT_THEME;
}
