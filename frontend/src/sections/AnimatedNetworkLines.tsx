import { motion } from 'framer-motion'
import { useEffect, useId, useState } from 'react'

const sortedPaths = [
  "M126.227 198.56H309.396L356.076 143.247H659.502",
  "M126.227 245.363H309.396L356.076 300.676H659.502",
  "M126.227 184.377H303.307L348.153 129.064H639.646",
  "M126.227 259.546H303.307L348.153 314.859H639.646",
  "M126.227 170.194H297.22L340.229 114.881H619.79",
  "M-1.4187 273.729H297.22L340.229 329.042H619.79",
  "M-58.1501 156.011H291.132L332.305 100.698H599.934",
  "M-1.4187 287.912H291.133L332.305 343.225H599.934",
  "M-49.6404 141.828H277.364L320.373 86.5154H599.934",
  "M-7.0918 302.095H277.364L320.373 357.408H599.934",
  "M-60.9866 127.646H259.662L305.032 72.3326H599.935",
  "M-4.25513 316.278H259.662L305.032 371.591H599.934",
  "M-52.4771 113.463H245.893L293.098 58.1497H599.934",
  "M-9.92847 330.46H245.893L293.098 385.773H599.934",
  "M-62.405 99.28H229.175L278.609 43.9669H599.934",
  "M-5.67358 344.643H229.175L278.609 399.956H599.934",
  "M-56.7317 85.0971H213.44L264.972 29.784H599.935",
  "M-0.000488281 358.826H213.44L264.972 414.139H599.934",
  "M-62.405 70.9143H199.671L253.04 15.6012H599.934",
  "M-5.67358 373.009H199.671L253.04 428.322H599.934",
  "M-56.7317 56.7314H183.936L239.402 1.41829H599.935",
  "M-0.000488281 387.192H183.936L239.402 442.505H599.934",
  "M-52.4771 42.5486H167.217L224.913 -12.7646H599.934",
  "M-24.1113 401.375H167.217L224.913 456.688H599.934",
  "M-66.6597 28.3657H157.383L216.39 -26.9474L599.935 -26.9474",
  "M-38.2939 415.557H157.383L216.39 470.871H599.935",
  "M-55.3135 14.1829H145.581L206.162 -41.1303L599.935 -41.1302",
  "M-55.3135 429.74H145.581L206.162 485.054H599.935",
  "M-78.0061 -5.48363e-06H129.847L192.525 -55.3131H599.934",
  "M-78.0061 443.923H129.847L192.525 499.236H599.934",
]

export function AnimatedNetworkLines({ isInView, color = '#24FF95' }: { isInView: boolean; color?: string }) {
  const uid = useId()
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const glowId = `${uid}-glow`

  useEffect(() => {
    const handleVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])
  const shouldAnimate = isInView && pageVisible

  return (
    <svg width="484" height="358" viewBox="0 0 593 453" fill="none" xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'hidden',
        WebkitMaskImage: 'radial-gradient(ellipse 65% 55% at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 75%)',
        maskImage: 'radial-gradient(ellipse 65% 55% at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 75%)',
        willChange: 'transform',
      }}
    >
      <defs>
        <filter id={glowId} x="17.6986" y="57.4109" width="280.88" height="283.716" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="30" result="effect1_foregroundBlur_0_1" />
        </filter>
      </defs>

      {sortedPaths.map((d, i) => {
        const pathId = `${uid}-pp-${i}`
        const maskId = `${uid}-pm-${i}`
        const gradId = `${uid}-pg-${i}`
        const beginTime = i === 0 ? '1s' : '1.4s'
        return (
          <g key={i}>
            <motion.path d={d} stroke="#272729" strokeWidth="1.55864" strokeLinecap="round" fill="none"
              initial={{ pathLength: 1, opacity: 0.6 }}
              animate={shouldAnimate ? { opacity: 1 } : { opacity: 0.3 }}
              transition={{ duration: 0.4 }}
            />
            {(i === 0 || i === 1) && (
              <>
                <defs>
                  <path id={pathId} d={d} />
                  <radialGradient id={gradId}>
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </radialGradient>
                  <mask id={maskId}>
                     <circle r="40" fill={`url(#${gradId})`}>
                       {shouldAnimate && <animateMotion dur="3.5s" repeatCount="indefinite" begin={beginTime} keyPoints="0;1;1" keyTimes="0;0.667;1" calcMode="linear">
                         <mpath href={`#${pathId}`} />
                       </animateMotion>}
                       {shouldAnimate && <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.067;0.6;0.667;1" dur="3.5s" repeatCount="indefinite" begin={beginTime} />}
                    </circle>
                  </mask>
                </defs>
                <path d={d} stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none" mask={`url(#${maskId})`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
              </>
            )}
          </g>
        )
      })}

      <motion.g filter={`url(#${glowId})`}
        initial={{ opacity: 0 }}
         animate={shouldAnimate ? { opacity: 0.8 } : { opacity: 0 }}
         transition={shouldAnimate ? { delay: 0.8, duration: 0.5 } : { duration: 0 }}
      >
        <path d="M136.155 197.851C136.155 185.71 145.998 175.867 158.139 175.867C170.279 175.867 180.122 185.71 180.122 197.851V200.687C180.122 212.828 170.279 222.671 158.139 222.671C145.998 222.671 136.155 212.828 136.155 200.687V197.851Z" fill={color} />
      </motion.g>
    </svg>
  )
}
