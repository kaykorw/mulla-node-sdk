const SECRET_QUERY_PARAMS = ['token'];
const PATTERN = new RegExp(`([?&](?:${SECRET_QUERY_PARAMS.join('|')})=)[^&#]*`, 'gi');

export function redactUrl(url: string): string {
  return url.replace(PATTERN, '$1***');
}
