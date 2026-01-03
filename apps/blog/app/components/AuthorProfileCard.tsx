'use client';

import React from 'react';
import { Github, Mail, MessageCircle, MonitorPlay, MousePointer2 } from 'lucide-react';
import Link from 'next/link';

interface AuthorProfileCardProps {
  className?: string;
}

export const AuthorProfileCard: React.FC<AuthorProfileCardProps> = ({ className }) => {
  return (
    <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-5 flex flex-col items-center text-center ${className}`}>
      {/* Avatar */}
      <div className="relative w-20 h-20 mb-3 group cursor-pointer">
        <div className="absolute inset-0 bg-gradient-to-tr from-primary to-purple-500 rounded-full blur-lg opacity-50 group-hover:opacity-80 transition-opacity" />
        <div className="relative w-full h-full rounded-full overflow-hidden border-2 border-white/20 group-hover:border-primary transition-colors">
            {/* Placeholder for avatar - using a generic premium looking gradient or user image if available */}
            {/* Ideally this comes from configuration/assets */}
            <img 
                src="https://github.com/shadcn.png" 
                alt="Golovin" 
                className="w-full h-full object-cover"
            />
        </div>
      </div>

      {/* Name & Bio */}
      <h2 className="text-lg font-bold text-white mb-0.5">Golovin</h2>
      <p className="text-xs text-gray-400 mb-4">一只小凉凉</p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 w-full mb-5 border-y border-white/5 py-3">
        <div className="flex flex-col items-center group cursor-pointer">
            <span className="text-base font-bold text-white group-hover:text-primary transition-colors">70</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">日志</span>
        </div>
        <div className="flex flex-col items-center group cursor-pointer">
            <span className="text-base font-bold text-white group-hover:text-primary transition-colors">11</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">分类</span>
        </div>
        <div className="flex flex-col items-center cursor-pointer group">
            <span className="text-base font-bold text-white group-hover:text-primary transition-colors">13</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">标签</span>
        </div>
      </div>

      {/* Social Links */}
      <div className="space-y-2 w-full flex-1 flex flex-col justify-center">
        <div className="grid grid-cols-2 gap-2">
             <Link href="https://github.com" target="_blank" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 justify-center">
                <Github className="w-3.5 h-3.5" />
                <span>Github</span>
             </Link>
             <Link href="mailto:example@email.com" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 justify-center">
                <Mail className="w-3.5 h-3.5" />
                <span>Email</span>
             </Link>
        </div>
         <div className="grid grid-cols-2 gap-2">
             <div className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 cursor-pointer justify-center">
                <MessageCircle className="w-3.5 h-3.5" />
                <span>Wechat</span>
             </div>
             <Link href="https://bilibili.com" target="_blank" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 justify-center">
                <MonitorPlay className="w-3.5 h-3.5" />
                <span>Bilibili</span>
             </Link>
        </div>
        <div className="flex justify-center">
             <Link href="https://gitee.com" target="_blank" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 w-1/2 justify-center">
                <MousePointer2 className="w-3.5 h-3.5" />
                <span>Gitee</span>
             </Link>
        </div>
      </div>
    </div>
  );
};

export default AuthorProfileCard;
