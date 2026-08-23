/**
 * One horizontal inset for the whole admin shell. Both the topbar row and the page
 * content below it use this, and that is the point: they were free to drift apart
 * before, which left the page heading floating well right of the topbar's own hamburger.
 *
 * The cap is deliberately between the two extremes this has been through. At 80rem the
 * shell spent ~290px a side as dead margin on a 1920px display; with no cap at all the
 * content ran to within 16px of the rail and read as having no margin. 98rem sits in
 * the middle, and because it is a cap rather than fixed padding it only claims width
 * that is genuinely spare — a narrow shell still fills, instead of being squeezed by an
 * inset chosen for a wide one.
 */
export const SHELL_INSET = "mx-auto w-full max-w-[98rem] px-4 sm:px-5";
