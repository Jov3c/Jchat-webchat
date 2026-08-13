


const loginForm = document.getElementById('adminLoginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('errorMessage');


document.querySelectorAll('[data-jchat-icon]').forEach((slot) => {
    slot.innerHTML = JchatUI.icon(slot.dataset.jchatIcon);
});

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();


    if (!username || !password) {
        showError('请输入用户名和密码');
        return;
    }

    try {

        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';


        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok && data.token) {

            localStorage.setItem('adminToken', data.token);
            localStorage.setItem('isAdmin', 'true');


            window.location.href = '/admin';
        } else {

            showError(data.error || '登录失败，请检查用户名和密码');
        }

    } catch (error) {
        console.error('登录错误:', error);
        showError('登录失败，请稍后重试');
    } finally {

        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
    }
});


function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}


function hideError() {
    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
}


usernameInput.addEventListener('input', hideError);
passwordInput.addEventListener('input', hideError);


usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        passwordInput.focus();
    }
});
