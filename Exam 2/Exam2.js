import { sleep, check } from 'k6';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

// Read data to register account from JSON
const users = new SharedArray('registerUsers', () => {
  return JSON.parse(open('./users.json'));
});

// Read data to login from JSON
const users1 = new SharedArray('loginUsers', () => {
  return JSON.parse(open('./users1.json'));
});
// Token
function getCsrfTokenFromLoginPage() {
  const res = http.post(
    'https://quickpizza.grafana.com/api/csrf-token',
    null,
    {
      headers: {
        accept: '*/*',
        origin: 'https://quickpizza.grafana.com',
        referer: 'https://quickpizza.grafana.com/login',
      },
    }
  );
 
  const cookies = res.cookies;
  const csrfToken = cookies['csrf_token']?.[0]?.value;
 
  console.log(`CSRF Token: ${csrfToken}`);
 
  return csrfToken;
}

// Register scenario
export const options = {
  scenarios: {
    register_scenario: {
      executor: 'shared-iterations',
      vus: 5,
      iterations: 5,
      exec: 'registerUser',
    },
// Login
    login_scenario: {
      executor: 'constant-arrival-rate',
      rate: 5,              
      timeUnit: '1s',      
      duration: '30s',      
      preAllocatedVUs: 5,   
      maxVUs: 10,
      exec: 'loginUser',
  },
  },
};

// Register
export function registerUser() {
  const user = users[(__VU - 1) % users.length];
  const uniqueUsername = `${user.username}_${__VU}_${__ITER}_${Date.now()}`;

  const payload = JSON.stringify({
    username: uniqueUsername,
    password: user.password,
  });

  const res = http.post(
    'https://quickpizza.grafana.com/api/users',
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'User created successfully': (r) => r.status === 201 || r.status === 200,
  });

  sleep(1);
}

 // Login
export function loginUser() {
  http.cookieJar(); // chỉ cần gọi để đảm bảo context
 
  const csrfToken = getCsrfTokenFromLoginPage();
  if (!csrfToken) {
    console.error('CSRF token not found');
    return;
  }
 
  const user = users[(__VU - 1) % users.length];
 
  const loginPayload = JSON.stringify({
    csrf: csrfToken,
    username: 'default',
    password: '12345678',
  });
 
  const loginRes = http.post(
    'https://quickpizza.grafana.com/api/users/token/login?set_cookie=true',
    loginPayload,
    {
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://quickpizza.grafana.com',
        referer: 'https://quickpizza.grafana.com/login',
      },
    }
  );
 
  console.log(`Login status: ${loginRes.status}`);
  console.log(loginRes.json().token);
 
  check(loginRes, {
    'login success': (r) => r.status === 200,
  });

  sleep(1);
// Order pizza
const payload = JSON.stringify({
  maxCaloriesPerSlice: 1000,
  mustBeVegetarian: false,
  excludedIngredients: [],
  excludedTools: [],
  maxNumberOfToppings: 5,
  minNumberOfToppings: 2,
  customName: '',
});

const orderPizzaRes = http.post(
  'https://quickpizza.grafana.com/api/pizza',
  payload,
  {
    headers: {
      'Content-Type': 'application/json',
    },
  }
);
check(orderPizzaRes, {
    'Order Pizza success': (r) => r.status === 200,
  });

sleep(1);

}

