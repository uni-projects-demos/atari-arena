/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly API_URL?: string;
  readonly WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
