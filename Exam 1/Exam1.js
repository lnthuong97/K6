import { sleep, check } from 'k6';
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { parseHTML } from 'k6/html';

// Read data to register account
const registerUsers = new SharedArray('registerUsers', () => {
  return open('./users.csv')
    .split('\n')
    .slice(1)        
    .filter(line => line.trim())
    .map(line => {
      const [Gender, FirstName, LastName, Email, Password] = line.split(',').map(v => v.trim());
      return { Gender, FirstName, LastName, Email, Password };
    });
});
// Read data to login
const loginUsers = new SharedArray('loginUsers', () => {
  return open('./users1.csv')
    .split('\n')
    .slice(1)         
    .filter(line => line.trim())
    .map(line => {
      const [Email, Password] = line.split(',').map(v => v.trim());
      return { Email, Password };
    });
});

function encodeForm(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

//Register scenario
export const options = {
  scenarios: {
    register_scenario: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '10s', target: 0 },
      ],
      exec: 'registerUser',
    },
// Login and Browsing scenario
    login_scenario: {
      executor: 'per-vu-iterations',
      VUs: 10,
      iterations: 5,
      startTime: '1m20s',
      exec: 'loginAndBrowse',
    },
  },
};

function extractProductNamesFromResponse(response, productNames) {
  const json = response.json();
  const html = json.updateflyoutcartsectionhtml;
  const doc = parseHTML(html);
  doc.find('div.name a').each((_, el) => {
    const name = el.text().trim();
    if (name) productNames.push(name);
  });
};

export function registerUser() {
  // Unique data
  const user = registerUsers[(__VU - 1) % registerUsers.length];
  console.log(`VU ${__VU} → using user: ${JSON.stringify(user)}`);

  const BASE_URL = 'http://localhost:5000/';
  const REGISTER_PATH = '/register?returnUrl=%2F';

  const jar = http.cookieJar();

  // Access the site to get token
  const getRes = http.get(`${BASE_URL}${REGISTER_PATH}`, { jar });
  const body = getRes.body;
  const tokenMatch = body.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  const csrfToken = tokenMatch ? tokenMatch[1] : null;

  if (!csrfToken) {
    console.error(`VU ${__VU} [ERROR] No CSRF token found, status ${getRes.status}`);
    return;
  }

  // Register form
  const payload = encodeForm({
    Gender: user.Gender,
    FirstName: user.FirstName,
    LastName: user.LastName,
    Email: user.Email,
    Company: '',
    Newsletter: 'true',
    Password: user.Password,
    ConfirmPassword: user.Password,
    'register-button': '',
    __RequestVerificationToken: csrfToken,
  });

  // Submit register form
  const postRes = http.post(
    `${BASE_URL}${REGISTER_PATH}`,
    payload,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE_URL,
      },
      jar,
      redirects: 0,
    }
  );

  // Check register process
  const success = check(postRes, {
    'Registration successful': (r) => r.status === 200 || r.status === 302,
  });

  if (!success) {
    console.error(`VU ${__VU} [FAIL] registration failed, status ${postRes.status}`);
    console.debug('Response body:', postRes.body);
  }
  sleep(1);
}

export function loginAndBrowse() {
  const user = loginUsers[(__VU - 1) % loginUsers.length];
  const jar = http.cookieJar();

  const loginPage = http.get('http://localhost:5000/login?returnurl=%2F', { jar });
  const tokenMatch = loginPage.body.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  if (!token) {
    console.error('No CSRF token found');
    return;
  }

  const payload = encodeForm({
    Email: user.Email,
    Password: user.Password,
    RememberMe: 'false',
    __RequestVerificationToken: token,
  });

  const loginResponse = http.post('http://localhost:5000/login?returnurl=%2F', payload, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'http://localhost:5000',
    },
    jar,
  });

  check(loginResponse, {
  'Login successful': (r) => r.status === 200,
  'User login succeed': (r) =>
    r.body.includes('My account') ||
    r.body.includes('Tài khoản của tôi'),
});

  const productNames = [];
  const isBrowsingNotebooks = Math.random() < 0.5;
  const category = isBrowsingNotebooks ? 'desktops' : 'cell-phones';
  const catResponse = http.get(`http://localhost:5000/${category}`, { jar });
  const tokenCatMatch = catResponse.body.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  const catToken = tokenCatMatch ? tokenCatMatch[1] : '';
  if (!catToken) return;

    const productId = category === 'computers'
    ? Math.floor(Math.random() * (3 - 1 + 1)) + 1
    : Math.floor(Math.random() * (20 - 18 + 1)) + 18;

  // Add to cart
  const addRes = http.post(
    `http://localhost:5000/addproducttocart/catalog/${productId}/1/1`,
    encodeForm({ __RequestVerificationToken: catToken }),
    {
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      jar,
    }
  );

  extractProductNamesFromResponse(addRes, productNames);

  check(addRes, {
    'Product added successfully': (r) => r.status === 200,
  });

  sleep(1);
}
