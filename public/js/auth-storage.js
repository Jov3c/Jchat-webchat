(function (global) {
    'use strict';

    var pageStorage = global.sessionStorage;
    var sharedStorage = global.localStorage;
    sharedStorage.removeItem('token');
    sharedStorage.removeItem('user');

    function getAuthToken() {
        return pageStorage.getItem('token');
    }

    function getStoredUser() {
        var value = pageStorage.getItem('user');
        if (!value) return null;
        try { return JSON.parse(value); } catch (_) { return null; }
    }

    function storeLogin(data) {
        var source = data.user || data;
        var username = source.username || '';
        var user = {
            id: source.id != null ? source.id : source.userId,
            username: username,
            nickname: source.nickname || username,
            avatar: source.avatar || 'images/default.png',
            bio: source.bio || '',
            gender: source.gender || 'other',
            presence_status: source.presence_status || 'online'
        };
        pageStorage.setItem('user', JSON.stringify(user));
        pageStorage.setItem('token', data.token);
        return user;
    }

    function updateStoredUser(user) {
        pageStorage.setItem('user', JSON.stringify(user));
    }

    function clearLogin() {
        pageStorage.removeItem('user');
        pageStorage.removeItem('token');
    }

    global.JchatAuthStorage = {
        getAuthToken: getAuthToken,
        getStoredUser: getStoredUser,
        storeLogin: storeLogin,
        updateStoredUser: updateStoredUser,
        clearLogin: clearLogin
    };
})(window);
