import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'manyuaru | 試着の技術検証',description:'Phase A・ローカル限定の試着PoC'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>;}
