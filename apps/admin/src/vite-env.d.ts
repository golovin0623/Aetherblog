/// <引用类型=“vite/client”/>

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_BLOG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
