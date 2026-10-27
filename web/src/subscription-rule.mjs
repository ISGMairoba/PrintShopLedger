// When a business's subscription has ended in read-only or locked mode, the device refuses new work
// before saving (the server refuses it too). Set from the app as the subscription loads.
let blocked = '';
/** The reason new work is refused ('' when it is allowed). */
export const setWritesBlocked = (reason) => {
  blocked = reason || '';
};
export function checkWritesAllowed() {
  if (blocked) throw Error(blocked);
}
