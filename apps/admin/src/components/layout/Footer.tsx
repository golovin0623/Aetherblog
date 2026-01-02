export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-4 px-6 border-t border-white/10 text-center text-gray-500 text-sm">
      <p>© {currentYear} AetherBlog. All rights reserved.</p>
    </footer>
  );
}

export default Footer;
