import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, MessageCircle, User, Mail, Lock } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';

const SignupPage = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');
  const { signup, error, isLoading, clearError } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    setLocalError('');

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }

    if (username.length < 3) {
      setLocalError('Username must be at least 3 characters');
      return;
    }

    await signup(username, email, password);
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-dark-900 flex items-center justify-center px-4 py-8 safe-top safe-bottom">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-6 md:mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl mb-4 shadow-lg shadow-primary-500/20">
            <MessageCircle size={32} className="text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white">Quick Meet</h1>
          <p className="text-dark-400 mt-2 text-sm">Create your account</p>
        </div>

        {/* Signup Form */}
        <div className="bg-dark-800 rounded-2xl p-6 md:p-8 border border-dark-700/50 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-6">Get started</h2>

          {displayError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl mb-4 animate-slide-down">
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Username</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field pl-10"
                  placeholder="johndoe"
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="^[a-zA-Z0-9_]+$"
                  title="Letters, numbers, and underscores only"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field pl-10"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10 pr-12"
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200 p-1"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Repeat your password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-3.5 text-base font-semibold mt-2"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating account...
                </span>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <p className="text-center text-dark-400 text-sm mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-400 hover:text-primary-300 font-semibold">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
