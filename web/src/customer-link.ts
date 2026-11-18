// At a branch with its own customers, a phone number may belong to a customer of another branch
// that this device cannot see. The app (App.tsx) sets how to ask the server about it; the customer
// form uses it to offer "Add them to this branch". Unset (null) everywhere else.
export type CustomerLink = {
  /** Is this number already a customer's somewhere in the business? (yes or no only) */
  elsewhere: (phone: string) => Promise<boolean>;
  /** Link that customer to this branch and download it; returns who it is. */
  link: (phone: string) => Promise<{ id: string; name: string }>;
};
let current: CustomerLink | null = null;
export function setCustomerLink(next: CustomerLink | null) {
  current = next;
}
export const customerLink = () => current;
