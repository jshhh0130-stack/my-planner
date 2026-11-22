// Firebase 연결 (구글 로그인 + 클라우드 저장)
// firebase-config.js 에 설정이 들어 있을 때만 불러옵니다.
const SDK = 'https://www.gstatic.com/firebasejs/13.4.0';

export async function createCloud(config) {
  const [appMod, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(config);
  const auth = A.getAuth(app);
  let db;
  try {
    // 오프라인에서도 쓰고, 연결되면 자동으로 올라가게 기기 안에 사본 보관
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
  } catch (e) {
    console.warn('오프라인 보관을 켜지 못했어요', e);
    db = F.getFirestore(app);
  }
  const cloud = new Cloud(auth, db, A, F);
  try { await A.getRedirectResult(auth); } catch (e) { console.warn(e); }
  return cloud;
}

class Cloud {
  constructor(auth, db, A, F) {
    this.name = 'cloud';
    this.auth = auth;
    this.db = db;
    this.A = A;
    this.F = F;
    this.user = null;
    this.unsubs = [];
    this.onError = null;
  }

  onAuth(cb) {
    return this.A.onAuthStateChanged(this.auth, (u) => {
      this.user = u;
      cb(u);
    });
  }

  async signIn() {
    const p = new this.A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try {
      await this.A.signInWithPopup(this.auth, p);
    } catch (e) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        await this.A.signInWithRedirect(this.auth, p);
      } else {
        throw e;
      }
    }
  }
  signOut() { return this.A.signOut(this.auth); }

  ref(col, id) { return this.F.doc(this.db, 'users', this.user.uid, col, id); }
  col(col) { return this.F.collection(this.db, 'users', this.user.uid, col); }

  subscribe(cb) {
    this.unsubscribe();
    const watch = (name, key) =>
      this.F.onSnapshot(
        this.col(name),
        (snap) => {
          const list = snap.docChanges().map((ch) =>
            ch.type === 'removed' ? { [key]: ch.doc.id, _deleted: true } : ch.doc.data(),
          );
          cb(name === 'days' ? { days: list } : { events: list });
        },
        (err) => {
          console.error(err);
          this.onError?.(err);
        },
      );
    const settings = this.F.onSnapshot(
      this.ref('meta', 'settings'),
      (snap) => cb({ settings: snap.exists() ? snap.data() : {} }),
      (err) => { console.error(err); this.onError?.(err); },
    );
    this.unsubs = [watch('days', 'date'), watch('events', 'id'), settings];
  }
  unsubscribe() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  putDay(d) { return this.F.setDoc(this.ref('days', d.date), d); }
  deleteDay(k) { return this.F.deleteDoc(this.ref('days', k)); }
  putEvent(e) { return this.F.setDoc(this.ref('events', e.id), e); }
  deleteEvent(id) { return this.F.deleteDoc(this.ref('events', id)); }
  putSettings(v) { return this.F.setDoc(this.ref('meta', 'settings'), v); }
  putPhoto(p) { return this.F.setDoc(this.ref('photos', p.id), p); }
  async getPhoto(id) {
    const s = await this.F.getDoc(this.ref('photos', id));
    return s.exists() ? s.data().data : null;
  }
  deletePhoto(id) { return this.F.deleteDoc(this.ref('photos', id)); }

  async getAll() {
    const [d, e] = await Promise.all([this.F.getDocs(this.col('days')), this.F.getDocs(this.col('events'))]);
    return { days: d.docs.map((x) => x.data()), events: e.docs.map((x) => x.data()) };
  }
  async allPhotos() {
    const s = await this.F.getDocs(this.col('photos'));
    return s.docs.map((x) => x.data());
  }
}
