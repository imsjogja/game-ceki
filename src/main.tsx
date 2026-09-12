import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource/bebas-neue'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
