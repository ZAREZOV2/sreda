/// <reference types="vite/client" />

declare module "*.sreda-theme.json" {
  const value: {
    $schema?: string;
    name: string;
    author?: string;
    version: string;
    description?: string;
    base: "dark" | "light";
    tokens: Record<string, string>;
    css?: string;
  };
  export default value;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.txt?raw" {
  const src: string;
  export default src;
}
