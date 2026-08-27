/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_BISBEARD_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __SIM_BUILD__: {
  version: string;
  commit: string | null;
};
