import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

/**
 * Pengaman terakhir untuk error render di browser.
 * Jangan membiarkan route game berubah menjadi layar kosong: pemain selalu
 * mempunyai jalan kembali ke beranda, termasuk saat state room kadaluarsa.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Tetap catat detail ke console browser untuk diagnosa tanpa menampilkan
    // data internal kepada pemain.
    console.error("Render aplikasi gagal", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="font-display text-4xl tracking-wide text-[#f5c036]">
            HALAMAN PERLU DIMUAT ULANG
          </p>
          <p className="mt-2 text-sm text-white/55">
            Sesi permainan sudah berakhir atau tidak lagi tersedia.
          </p>
          <a href="/" className="btn-gold mt-6 h-11 px-6 text-lg">
            KEMBALI KE BERANDA
          </a>
        </div>
      </main>
    );
  }
}
