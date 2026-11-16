// Online features (names on the leaderboard, log in, streak sync) use Supabase.
// Paste your project's two PUBLIC values here. Both are designed to be visible
// in a browser, so it is fine to commit them:
//   SUPABASE_URL      -> Supabase dashboard -> Project Settings -> Data API -> Project URL
//   SUPABASE_ANON_KEY -> Supabase dashboard -> Project Settings -> API Keys -> "Publishable key"
//                        (starts with sb_publishable_; the older "anon public" key also works)
//
// NEVER paste the "secret" / "service_role" key, the database password or the
// Google client secret into this file or anywhere else in this repository.
//
// Leave either one empty to run the game offline-only (no leaderboard, no login).
window.JOSELE_CONFIG = {
  // The address players share with friends.
  SITE_URL: 'https://josele.io',
  SUPABASE_URL: 'https://cvtbfehtshdhbaiwnqpu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_MDjshB1KRCNSLyeOwF-qQA_uzCjgNp7'
};
