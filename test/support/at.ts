/**
 * Narrows an index access that `noUncheckedIndexedAccess` widens to `T | undefined`.
 *
 * A test that has just asserted a length and then reads element 0 knows the element is there, but the
 * compiler does not, and the two ways of telling it — a non-null assertion or a cast — both silence the
 * check rather than answer it. This answers it: an absent element becomes a named failure at the read,
 * instead of `undefined` flowing into an assertion that then compares against the wrong thing.
 * @req FR-NODE-164
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`expected an element at index ${index}, but the collection holds ${items.length}`);
  }
  return value;
}
