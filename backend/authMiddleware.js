import { auth } from '@app/api/auth/[...nextauth]/route';
import { getServerSession } from 'next-auth';

const isAuthenticatedUser = async (req, res) => {
  const session = await getServerSession(auth);

  if (!session) {
    return res.error('Login first to access this route', 401);
  }

  req.user = session.user;
};

export default isAuthenticatedUser;
