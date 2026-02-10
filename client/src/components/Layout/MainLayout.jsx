import Sidebar from './Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import useChatStore from '../../store/useChatStore';
import { MessageCircle, Shield, Phone, Monitor } from 'lucide-react';

const MainLayout = () => {
  const { activeChat } = useChatStore();

  return (
    <div className="h-screen h-[100dvh] flex overflow-hidden">
      {/* Sidebar — full screen on mobile when no chat, hidden when chat active */}
      <div className={`
        ${activeChat ? 'hidden md:flex' : 'flex'}
        w-full md:w-80 lg:w-96 flex-shrink-0 flex-col
      `}>
        <Sidebar />
      </div>

      {/* Main content — hidden on mobile when no chat, full screen when chat active */}
      <div className={`
        ${activeChat ? 'flex' : 'hidden md:flex'}
        flex-col flex-1 min-w-0 h-full
      `}>
        {activeChat ? (
          /* ChatWindow now contains its own header */
          <ChatWindow />
        ) : (
          /* Desktop no-chat state */
          <>
            <div className="h-16 bg-dark-800 border-b border-dark-700 hidden md:flex items-center justify-center flex-shrink-0">
              <p className="text-dark-500 text-sm">Select a conversation to start messaging</p>
            </div>
            <div className="flex-1 flex items-center justify-center bg-dark-900 p-6">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 bg-gradient-to-br from-primary-500/20 to-primary-600/10 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary-500/5">
                  <MessageCircle size={40} className="text-primary-400" />
                </div>
                <h3 className="text-2xl font-semibold text-white mb-2">Welcome to Quick Meet</h3>
                <p className="text-dark-400 mb-8 leading-relaxed">
                  Select a conversation from the sidebar to start messaging, or create a new group to collaborate.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <div className="flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-full px-4 py-2 text-sm text-dark-300">
                    <Shield size={14} className="text-emerald-400" />
                    <span>E2E Encrypted</span>
                  </div>
                  <div className="flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-full px-4 py-2 text-sm text-dark-300">
                    <Phone size={14} className="text-primary-400" />
                    <span>P2P Calls</span>
                  </div>
                  <div className="flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-full px-4 py-2 text-sm text-dark-300">
                    <Monitor size={14} className="text-purple-400" />
                    <span>Screen Share</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MainLayout;
