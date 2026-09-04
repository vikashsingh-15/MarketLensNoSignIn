import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api' });

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError<{ message?: string }>(error)) return fallback;
  return error.response?.data?.message || fallback;
}
