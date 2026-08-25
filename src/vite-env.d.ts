/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_BISBEARD_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
