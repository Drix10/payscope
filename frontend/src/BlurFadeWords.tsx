import { motion } from 'framer-motion'
import type { CSSProperties } from 'react'

export function BlurFadeWords({
  text,
  baseDelay = 0,
  isInView = true,
  wordStyle,
}: {
  text: string
  baseDelay?: number
  isInView?: boolean
  wordStyle?: CSSProperties
}) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={{
            opacity: isInView ? 1 : 0,
            filter: isInView ? 'blur(0px)' : 'blur(8px)',
          }}
          transition={{
            delay: isInView ? baseDelay + i * 0.07 : 0,
            duration: 0.3,
            ease: 'easeOut',
          }}
          style={{
            display: 'inline-block',
            marginRight: i < words.length - 1 ? '0.3em' : 0,
            ...wordStyle,
          }}
        >
          {word}
        </motion.span>
      ))}
    </>
  )
}
