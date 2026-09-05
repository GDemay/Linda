import { CHANGELOG } from '@/lib/changelog.ts';
import { json } from '@/lib/http.ts';

export const GET = async () => json({ entries: CHANGELOG });
