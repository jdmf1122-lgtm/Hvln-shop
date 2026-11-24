import type { Product, Review } from '../types';

export const DEFAULT_SIZES = '35-36, 37-38, 39-40, 41-42, 43-44';

export const FALLBACK_IMAGE =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
      <rect width="800" height="600" fill="#e6fcf5"/>
      <rect x="40" y="40" width="720" height="520" rx="24" fill="#ffffff" stroke="#12b886" stroke-width="4"/>
      <text x="400" y="290" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#087f5b" text-anchor="middle">HVLN Shop</text>
      <text x="400" y="345" font-family="Arial, sans-serif" font-size="22" fill="#495057" text-anchor="middle">Quality Footwear</text>
    </svg>`
  );

export const defaultProducts: Product[] = [
  {
    id: 1,
    name: 'Havaianas Top',
    price: 1500,
    category: 'Flip-Flops',
    image: 'Images/flipflop(marine blue).png',
    description: 'Classic and durable Havaianas flip-flops.',
    sizes: '35-36, 37-38, 39-40, 41-42, 43-44',
    stock: 20,
  },
  {
    id: 2,
    name: 'Havaianas Slim',
    price: 899,
    category: 'Flip-Flops',
    image:
      'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80',
    description: 'Slim and stylish flip-flops.',
    sizes: '35-36, 37-38, 39-40, 41-42',
    stock: 15,
  },
  {
    id: 3,
    name: 'Havaianas You',
    price: 999,
    category: 'Sandals',
    image:
      'https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=800&q=80',
    description: 'Stylish sandals for everyday use.',
    sizes: '35-36, 37-38, 39-40, 41-42',
    stock: 12,
  },
  {
    id: 4,
    name: 'Havaianas Casual',
    price: 799,
    category: 'Slippers',
    image:
      'https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=800&q=80',
    description: 'Simple and comfortable footwear.',
    sizes: '35-36, 37-38, 39-40, 41-42, 43-44',
    stock: 18,
  },
  {
    id: 5,
    name: 'Havaianas Street',
    price: 1099,
    category: 'Sandals',
    image:
      'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80',
    description: 'Perfect for casual outdoor activities.',
    sizes: '35-36, 37-38, 39-40, 41-42',
    stock: 10,
  },
  {
    id: 6,
    name: 'Havaianas Classic',
    price: 749,
    category: 'Flip-Flops',
    image:
      'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80',
    description: 'Classic and comfortable Havaianas.',
    sizes: '35-36, 37-38, 39-40, 41-42, 43-44',
    stock: 25,
  },
];

export const defaultReviews: Review[] = [
  {
    id: 1,
    name: 'Happy Customer',
    rating: 5,
    comment: 'Very comfortable and good quality!',
    date: '',
  },
  {
    id: 2,
    name: 'Satisfied Buyer',
    rating: 5,
    comment: 'Fast and convenient ordering process.',
    date: '',
  },
];

export function safeParseStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw === 'undefined') return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function parseSizes(sizes?: string): string[] {
  const list = String(sizes || DEFAULT_SIZES)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_SIZES.split(',').map((s) => s.trim());
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getNextNumber(
  existingNumbers: Array<string | undefined>,
  prefix: string
): string {
  let maxNum = 0;
  for (const numStr of existingNumbers) {
    if (!numStr) continue;
    const match = numStr.match(/(\d+)$/);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
}

export function getExpirationStatus(expirationDate: string): {
  status: string;
  statusClass: string;
} {
  if (!expirationDate) {
    return { status: 'No expiration date', statusClass: '' };
  }

  const parts = expirationDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { status: 'No expiration date', statusClass: '' };
  }

  const [year, month, day] = parts;
  const expiration = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffMs = expiration.getTime() - today.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return { status: 'Expired', statusClass: 'expiration-expired' };
  }
  if (days === 0) {
    return { status: 'Expiring Today', statusClass: 'expiration-warning' };
  }
  if (days <= 30) {
    return {
      status: `Expiring Soon (${days} days)`,
      statusClass: 'expiration-warning',
    };
  }
  return { status: 'Good', statusClass: 'expiration-normal' };
}

export async function tryJsonFetch(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; data: Record<string, unknown> } | null> {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return null;
  }
}
