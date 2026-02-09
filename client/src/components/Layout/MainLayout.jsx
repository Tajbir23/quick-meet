import Sidebar from './Sidebar';
import Header from './Header';
import ChatWindow from '../Chat/ChatWindow';
import useChatStore from '../../store/useChatStore';

const MainLayout = () => {
  const { activeChat } = useChatStore();

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        {activeChat ? (
          <ChatWindow />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-dark-900">
            <div className="text-center">
              <div className="w-20 h-20 bg-dark-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-dark-300 mb-1">Welcome to Quick Meet</h3>
              <p className="text-sm text-dark-500 max-w-sm">
                Select a conversation from the sidebar to start messaging, or create a new group.
              </p>
              <div className="mt-6 flex items-center justify-center gap-4 text-xs text-dark-600">
                <span className="flex items-center gap-1">🔒 E2E Encrypted</span>
                <span className="flex items-center gap-1">📞 P2P Calls</span>
                <span className="flex items-center gap-1">🖥️ Screen Share</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MainLayout;
