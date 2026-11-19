/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: string;
  readonly VITE_GITHUB_OWNER?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_GITHUB_BRANCH?: string;
  readonly VITE_GITHUB_FILE_PATH?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_AUTH_HELPER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
