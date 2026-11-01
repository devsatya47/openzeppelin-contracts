/**
 * Browser extensions (translators, password managers, crypto wallets) and Chrome's built-in
 * translation sometimes move or delete page elements that React manages. React then fails with
 * "Failed to execute 'removeChild'/'insertBefore' on 'Node'" and the page crashes. This is the
 * widely used workaround (facebook/react#11538): skip the DOM operation instead of throwing.
 */
export function installDomGuard() {
  if (typeof Node !== 'function' || !Node.prototype) return;
  const proto = Node.prototype as any;
  if (proto.__csGuarded) return;
  proto.__csGuarded = true;

  const removeChild = proto.removeChild;
  proto.removeChild = function (child: Node) {
    if (child.parentNode !== this) {
      console.warn('Skipped removeChild of a node moved by a browser extension', child);
      return child;
    }
    return removeChild.call(this, child);
  };

  const insertBefore = proto.insertBefore;
  proto.insertBefore = function (newNode: Node, reference: Node | null) {
    if (reference && reference.parentNode !== this) {
      console.warn('Skipped insertBefore next to a node moved by a browser extension', reference);
      return newNode;
    }
    return insertBefore.call(this, newNode, reference);
  };
}
