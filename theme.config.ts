import { defineThemeConfig } from '@utils/defineThemeConfig'
import previewImage from '@assets/img/social-preview-image.png'
import logoImage from '@assets/img/logo.svg'

export default defineThemeConfig({
  name: 'Ibnu Rizal Mutaqim',
  id: 'ibnu-rizal-mutaqim-portfolio',
  logo: logoImage,
  seo: {
    title: 'Ibnu Rizal Mutaqim',
    description:
      'Website profil profesional Ibnu Rizal Mutaqim. Menampilkan pengalaman kerja, portofolio proyek, dan kontak kolaborasi.',
    author: 'Ibnu Rizal Mutaqim',
    image: previewImage,
  },
  colors: {
    primary: '#d648ff',
    secondary: '#00d1b7',
    neutral: '#b9bec4',
    outline: '#ff4500',
  },
  navigation: {
    darkmode: true,
    items: [
      {
        type: 'link',
        label: 'About Me',
        href: '/',
      },
      {
        type: 'link',
        label: 'Experience & Portfolio',
        href: '/portfolio',
      },
      {
        type: 'link',
        label: 'Blog',
        href: '/blog',
      },
      {
        type: 'link',
        label: 'Contact',
        href: '/contact',
      },
      {
        type: 'link',
        label: 'GitHub',
        href: 'https://github.com/IbnuRizalll',
        icon: 'lucide:github',
        external: true,
        excludeFromLauncher: true,
      },
    ],
  },
  socials: [
    {
      label: 'GitHub',
      href: 'https://github.com/IbnuRizalll',
      icon: 'lucide:github',
      external: true,
    },
    {
      label: 'LinkedIn',
      href: 'https://www.linkedin.com/in/ibnu-rizal-370864295',
      icon: 'lucide:linkedin',
      external: true,
    },
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/ibnrrmm/',
      icon: 'lucide:instagram',
      external: true,
    },
  ],
})
