from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

engine = create_engine("sqlite:///:memory:", poolclass=QueuePool, pool_size=2, max_overflow=0)
SessionLocal = sessionmaker(bind=engine)

class AutoClose:
    def __init__(self):
        self.db = SessionLocal()
    def __getattr__(self, name):
        return getattr(self.db, name)
    def __del__(self):
        self.db.close()
        print("Closed!")

def get_db():
    return AutoClose()

for i in range(5):
    db = get_db()
    db.execute("SELECT 1")
    print(f"Query {i} done")

print("All done")
