// 认证中间件：用户/管理员鉴权
function createMiddleware({ db, jwt, JWT_SECRET, verifyCurrentUserToken }) {
    const authenticateUser = (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            next();
            return;
        }
        try {
            const user = verifyCurrentUserToken(token, JWT_SECRET, db);
            if (!user) {
                return res.status(401).json({ error: '用户不存在或已被删除', code: 'user_deleted' });
            }
            req.userId = user.id;
            req.userSessionId = user.active_session_id;
            next();
        } catch (error) {
            const code = error?.code || 'invalid_token';
            return res.status(401).json({
                error: code === 'session_replaced' ? 'Account signed in on another page' : 'Invalid or expired token',
                code
            });
        }
    };

    function requireUser(req, res, next) {
        const parsed = Number.parseInt(req.userId, 10);
        if (!Number.isInteger(parsed)) return res.status(401).json({ error: 'Authorization required' });
        req.userId = parsed;
        next();
    }

    function requireAuthenticatedUser(req, res, next) {
        const parsed = Number.parseInt(req.userId, 10);
        if (!Number.isInteger(parsed)) return res.status(401).json({ error: 'Authorization required' });
        req.userId = parsed;
        next();
    }

    const authenticateAdmin = (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Admin token required' });
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.admin) {
                next();
            } else {
                res.status(403).json({ error: 'Not authorized as admin' });
            }
        } catch (error) {
            res.status(401).json({ error: 'Invalid or expired token' });
        }
    };

    return { authenticateUser, requireUser, requireAuthenticatedUser, authenticateAdmin };
}

module.exports = createMiddleware;
