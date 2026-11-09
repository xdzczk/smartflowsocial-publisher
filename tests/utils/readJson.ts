export async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected a JSON object');
  }
  return value as T;
}
