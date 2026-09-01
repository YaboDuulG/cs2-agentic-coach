"use client";

// The ONE page-enter animation used everywhere (spatial consistency): a
// 300ms fade-up with a 50ms child stagger on the strong ease-out token.
// Reduced motion keeps the fade, drops the movement. Use <PageTransition>
// around a page's main content and <PageSection> for staggered children.

import { motion, useReducedMotion, Variants } from "framer-motion";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function usePageVariants(): { page: Variants; item: Variants } {
  const reduce = useReducedMotion();
  return {
    page: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, y: reduce ? 0 : 12 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
    },
  };
}

export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { page } = usePageVariants();
  return (
    <motion.div initial="hidden" animate="visible" variants={page} className={className}>
      {children}
    </motion.div>
  );
}

export function PageSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { item } = usePageVariants();
  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}
