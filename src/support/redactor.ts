const SECRET_QUERY_PARAMS = ['token'];
const PATTERN = new RegExp(`([?&](?:${SECRET_QUERY_PARAMS.join('|')})=)[^&#]*`, 'gi');

/** @internal Removes secrets (e.g. checkout tokens) from URLs that may end up in logs or error messages. */
export function redactUrl(url: string): string {
  return url.replace(PATTERN, '$1***');
}
