/**
 * Build-time configuration, all of it public. See `.env.example` for what each
 * value means and `src/lib/config.ts` for why a client ID is safe to ship.
 */
interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  readonly VITE_SPOTIFY_REDIRECT_URI?: string;
  readonly VITE_ONEDRIVE_CLIENT_ID?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
