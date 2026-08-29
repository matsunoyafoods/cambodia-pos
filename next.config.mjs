/** @type {import('next').NextConfig} */
const nextConfig = {
  // matsunoya-dine と同じ方針: フィンガープリント漏洩防止
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
