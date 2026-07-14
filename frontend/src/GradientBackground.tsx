import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react'

export function GradientBackground() {
  return (
    <ShaderGradientCanvas
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        backgroundColor: '#000000',
      }}
      pixelDensity={1}
      fov={45}
    >
      <ShaderGradient
        animate="on"
        brightness={1}
        cAzimuthAngle={180}
        cDistance={2.8}
        cPolarAngle={80}
        cameraZoom={9.1}
        color1="#606080"
        color2="#8d7dca"
        color3="#212121"
        envPreset="city"
        grain="on"
        lightType="3d"
        positionX={0}
        positionY={0}
        positionZ={0}
        range="disabled"
        rangeStart={0}
        rangeEnd={40}
        reflection={0.1}
        rotationX={50}
        rotationY={0}
        rotationZ={-60}
        shader="defaults"
        type="waterPlane"
        uAmplitude={0}
        uDensity={1.5}
        uFrequency={0}
        uSpeed={0.3}
        uStrength={1.5}
        uTime={8}
        wireframe={false}
        zoomOut={false}
      />
    </ShaderGradientCanvas>
  )
}
