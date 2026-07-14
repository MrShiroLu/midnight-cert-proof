import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

const Landing = lazy(() =>
  import('./Landing').then((m) => ({ default: m.Landing })),
)
const AppShell = lazy(() =>
  import('./AppShell').then((m) => ({ default: m.AppShell })),
)

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-svh bg-black" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<AppShell />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
