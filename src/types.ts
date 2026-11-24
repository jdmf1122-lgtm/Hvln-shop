export type Role = 'customer' | 'owner' | null;

export type PageId =
  | 'home'
  | 'products'
  | 'categories'
  | 'reviews'
  | 'orders'
  | 'inventory'
  | 'pos'
  | 'account';

export type InventoryTab =
  | 'productList'
  | 'customerList'
  | 'supplierList'
  | 'expirationList';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  image: string;
  description: string;
  sizes: string;
  stock: number;
}

export interface CartItem {
  productId: number;
  size: string;
  quantity: number;
}

export interface PosCartItem {
  productId: number;
  quantity: number;
}

export interface Customer {
  id: number | string;
  customerNumber?: string;
  name: string;
  username: string;
  password?: string;
  email: string;
  contact: string;
  address: string;
}

export interface OwnerUser {
  name: string;
  username: string;
  role: 'owner';
}

export type CurrentUser = Customer | OwnerUser | null;

export interface OrderItem {
  productId: number;
  name: string;
  image: string;
  size?: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface OrderBuyer {
  name: string;
  username: string;
  email: string;
  contact: string;
  address: string;
}

export interface Order {
  id: string;
  date: string;
  customerUsername: string | null;
  buyer: OrderBuyer;
  items: OrderItem[];
  total: number;
  payment: string;
  status: string;
  returnReason?: string;
  returnDate?: string;
}

export interface Supplier {
  id: number;
  supplierNumber: string;
  name: string;
  contact: string;
  email: string;
  address: string;
}

export interface ProductDetail {
  supplierId: string;
  expirationDate: string;
}

export interface Review {
  id: number;
  name: string;
  username?: string;
  rating: number;
  comment: string;
  date: string;
}
